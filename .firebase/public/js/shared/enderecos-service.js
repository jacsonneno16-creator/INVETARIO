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
