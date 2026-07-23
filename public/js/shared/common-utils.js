'use strict';
// Utilitários compartilhados
function escHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function escAttr(str) {
  return escHTML(str).replace(/`/g, '&#096;');
}
window.escHTML = window.escHTML || escHTML;
// Aliases legados usados por telas antigas do Analista.
window.escapeHTML = window.escapeHTML || escHTML;
window.escapeHtml = window.escapeHtml || escHTML;
window.esc = window.esc || escHTML;
window.escAttr = window.escAttr || escAttr;

function fmtData(valor) {
  if (!valor) return '—';
  try {
    var d = valor;
    if (valor && typeof valor.toDate === 'function') d = valor.toDate();
    else if (!(valor instanceof Date)) {
      var txt = String(valor).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) {
        var partes = txt.split('-');
        return partes[2] + '/' + partes[1] + '/' + partes[0];
      }
      d = new Date(valor);
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) return String(valor);
    return d.toLocaleDateString('pt-BR');
  } catch (e) { return String(valor || '—'); }
}
window.fmtData = window.fmtData || fmtData;

const _isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
function dbg(...args) { if (_isDev) console.log(...args); }
window.dbg = window.dbg || dbg;


function _normCapaDup(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

function _agruparCapasDuplicadas(origem) {
  const lista = Array.isArray(origem)
    ? origem
    : (Array.isArray(window?.ENDDB?.lista) ? window.ENDDB.lista : []);
  const mapa = new Map();
  for (const item of (lista || [])) {
    const capa = _normCapaDup(item?.capa_palete || item?.capa || item?.palete_key || item?.pallet || '');
    if (!capa) continue;
    const cur = mapa.get(capa) || { capa_palete: capa, total: 0, itens: [] };
    cur.total += 1;
    cur.itens.push(item);
    mapa.set(capa, cur);
  }
  return Array.from(mapa.values()).filter(x => x.total > 1);
}
window._agruparCapasDuplicadas = window._agruparCapasDuplicadas || _agruparCapasDuplicadas;
