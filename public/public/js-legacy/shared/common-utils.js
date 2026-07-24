'use strict';
// Utilitários compartilhados
function escHTML(str) {
    if (str == null)
        return '';
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
var _isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
function dbg() {
    var args = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        args[_i] = arguments[_i];
    }
    if (_isDev)
        console.log.apply(console, args);
}
window.dbg = window.dbg || dbg;
function _normCapaDup(v) {
    return String(v == null ? '' : v).trim().toUpperCase();
}
function _agruparCapasDuplicadas(origem) {
    var _a;
    var lista = Array.isArray(origem)
        ? origem
        : (Array.isArray((_a = window === null || window === void 0 ? void 0 : window.ENDDB) === null || _a === void 0 ? void 0 : _a.lista) ? window.ENDDB.lista : []);
    var mapa = new Map();
    for (var _i = 0, _b = (lista || []); _i < _b.length; _i++) {
        var item = _b[_i];
        var capa = _normCapaDup((item === null || item === void 0 ? void 0 : item.capa_palete) || (item === null || item === void 0 ? void 0 : item.capa) || (item === null || item === void 0 ? void 0 : item.palete_key) || (item === null || item === void 0 ? void 0 : item.pallet) || '');
        if (!capa)
            continue;
        var cur = mapa.get(capa) || { capa_palete: capa, total: 0, itens: [] };
        cur.total += 1;
        cur.itens.push(item);
        mapa.set(capa, cur);
    }
    return Array.from(mapa.values()).filter(function (x) { return x.total > 1; });
}
window._agruparCapasDuplicadas = window._agruparCapasDuplicadas || _agruparCapasDuplicadas;
