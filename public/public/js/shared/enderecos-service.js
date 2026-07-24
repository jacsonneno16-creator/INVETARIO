'use strict';
// Regras compartilhadas de endereços para evitar duplicação no analista.
function dtSalvarCapacidadeEndereco(endCod, novaCap, opts) {
  const options = Object.assign({ allowNull: false, refresh: null }, opts || {});
  if (!window.ENDDB || !Array.isArray(ENDDB.lista)) return { ok: false, reason: 'enddb' };
  const end = ENDDB.lista.find(e => e.endereco === endCod);
  if (!end) return { ok: false, reason: 'not_found' };

  let cap = null;
  if (novaCap !== null && novaCap !== '') {
    cap = parseInt(novaCap, 10);
    if (Number.isNaN(cap) || cap < 0) return { ok: false, reason: 'invalid' };
  } else if (!options.allowNull) {
    cap = parseInt(novaCap, 10);
    if (Number.isNaN(cap) || cap < 0) return { ok: false, reason: 'invalid' };
  }

  end.capacidade_paletes = cap;
  if (cap === 0) end.ativo = false;

  const setor = end.setor || end.local_area || 'SEM LOCAL';
  if (ENDDB.porSetor && ENDDB.porSetor[setor]) {
    const e2 = ENDDB.porSetor[setor].find(x => x.endereco === endCod);
    if (e2) {
      e2.capacidade_paletes = cap;
      if (cap === 0) e2.ativo = false;
    }
  }

  if (window.storageSave && window.KEYS) storageSave(KEYS.enderecos, ENDDB.lista);
  if (typeof options.refresh === 'function') options.refresh(cap);
  return { ok: true, cap };
}
window.dtSalvarCapacidadeEndereco = window.dtSalvarCapacidadeEndereco || dtSalvarCapacidadeEndereco;

(function(global){
  'use strict';
  function texto(v){ return String(v == null ? '' : v).trim(); }
  function partes(endereco){
    const bruto=texto(endereco);
    const p=bruto.split('.').map(x=>x.trim()).filter(Boolean);
    return {bruto,loja:p[0]||'',local:p[1]||'',area:p[2]||'',rua:p[3]||p[0]||'',coluna:p[4]||'',nivel:p[5]||'',sequencia:p[6]||'',lista:p};
  }
  function chave(endereco){ return texto(endereco).toUpperCase().split('.').map(x=>x.trim()).filter(Boolean).join('.'); }
  global.DTEnderecos=global.DTEnderecos||{};
  global.DTEnderecos.partes=partes;
  global.DTEnderecos.chave=chave;
})(window);
