'use strict';
// Utilitários compartilhados

// Debounce global usado pelos campos de busca das telas do Analista.
// Evita renderizar a tabela a cada tecla e mantém um temporizador separado por campo.
(function(global){
  var timers = Object.create(null);
  global._debounce = global._debounce || function(chave, callback, atraso){
    var id = String(chave || 'default');
    if (timers[id]) clearTimeout(timers[id]);
    timers[id] = setTimeout(function(){
      delete timers[id];
      if (typeof callback === 'function') callback();
    }, Number.isFinite(Number(atraso)) ? Number(atraso) : 180);
  };
})(window);

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

// Defesa central para as renderizações legadas que ainda usam innerHTML.
// O conteúdo é analisado em um documento inerte antes de chegar ao DOM ativo.
(function instalarRenderizacaoSegura(global){
  if (!global.Element || !global.DOMParser || global.__dtInnerHTMLProtegido) return;
  var descriptor = Object.getOwnPropertyDescriptor(global.Element.prototype, 'innerHTML');
  if (!descriptor || !descriptor.configurable || !descriptor.get || !descriptor.set) return;
  var tagsBloqueadas = 'script,iframe,object,embed,base,meta,link,foreignObject';
  function limpar(html) {
    var parsed = new global.DOMParser().parseFromString(
      '<!doctype html><html><body>' + String(html == null ? '' : html) + '</body></html>',
      'text/html'
    );
    parsed.querySelectorAll(tagsBloqueadas).forEach(function(node){ node.remove(); });
    parsed.body.querySelectorAll('*').forEach(function(node){
      Array.from(node.attributes).forEach(function(attribute){
        var name = attribute.name.toLowerCase();
        var value = String(attribute.value || '').trim()
          .replace(/[\u0000-\u001f\u007f\s]+/g, '')
          .toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcdoc' ||
            ((name === 'href' || name === 'src' || name === 'xlink:href' ||
              name === 'formaction' || name === 'action') &&
             (value.indexOf('javascript:') === 0 || value.indexOf('vbscript:') === 0 ||
              value.indexOf('data:text/html') === 0))) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return descriptor.get.call(parsed.body);
  }
  Object.defineProperty(global.Element.prototype, 'innerHTML', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set: function(value){ descriptor.set.call(this, limpar(value)); }
  });
  global.__dtInnerHTMLProtegido = true;
  global.DTSanitizeHTML = limpar;
})(window);

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

// Compatibilidade global usada pelos módulos do Analista.
// Mantida aqui para que a ordem de carregamento dos módulos não quebre as telas.
function fmtTs(valor) {
  if (!valor) return '—';
  try {
    var d = valor;
    if (valor && typeof valor.toDate === 'function') d = valor.toDate();
    else if (!(valor instanceof Date)) d = new Date(valor);
    if (!(d instanceof Date) || isNaN(d.getTime())) return String(valor || '—');
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) { return String(valor || '—'); }
}
window.fmtTs = window.fmtTs || fmtTs;
window.fmtDataHora = window.fmtDataHora || fmtTs;

function statusBadge(status) {
  var s = String(status || '').trim().toUpperCase();
  if (s === 'ATIVO' || s === 'ABERTO' || s === 'CONCLUIDO' || s === 'CONCLUÍDO' || s === 'OK' || s === 'CONFIRMADO' || s === 'CONFIRMADO_SEM_AJUSTE') return 'b-green';
  if (s === 'PAUSADO' || s === 'PENDENTE' || s === 'AGUARDANDO' || s === 'CONFIRMADO_COM_AJUSTE') return 'b-yellow';
  if (s === 'DIVERGENTE' || s === 'ERRO' || s === 'BLOQUEADO' || s === 'CANCELADO') return 'b-red';
  if (s === 'FECHADO' || s === 'FINALIZADO' || s === 'INATIVO') return 'b-gray';
  if (s === 'LIBERADO' || s === 'LIBERADA' || s === 'EM_ANDAMENTO' || s === 'REABERTO_ALTERACAO_BASE') return 'b-blue';
  return 'b-gray';
}
window.statusBadge = window.statusBadge || statusBadge;


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


// Chave operacional única do fluxo de inventário.
// Todas as telas e ações devem relacionar registros por:
// inventário canônico + endereço normalizado + produto normalizado.
(function(global){
  function texto(v){
    return String(v == null ? '' : v).trim().toUpperCase();
  }
  function endereco(v){
    // Remove diferenças apenas de apresentação (pontos, espaços, barras e hífens).
    // Ex.: 14.1520.1.5.2.4.1.1 e 14.1520.1.5.24.1.1 continuam diferentes
    // se a sequência numérica realmente for diferente; já espaços/pontuação não interferem.
    return texto(v).replace(/[^A-Z0-9]/g, '');
  }
  function inventario(obj, inventarios){
    obj = obj || {};
    var bruto = texto(obj.inventario_id || obj.inventarioId || obj.inventario || '');
    var lista = Array.isArray(inventarios) ? inventarios : [];
    var achado = lista.find(function(i){
      return [i && i.id, i && i.codigo, i && i.nome, i && i.inventario_id, i && i.inventarioId]
        .filter(Boolean).map(texto).includes(bruto);
    });
    return texto((achado && (achado.id || achado.codigo)) || bruto);
  }
  function produto(obj){
    obj = obj || {};
    var ids = [
      obj.produto_id, obj.codigo_interno, obj.codigoInterno,
      obj.codigo_produto, obj.codigoProduto, obj.produto,
      obj.produto_contado, obj.produto_recontagem, obj.produto_primeira,
      obj.gtin, obj.ean, obj.dun, obj.codigo_lido, obj.codigoLido
    ].map(texto).filter(Boolean);
    // Quando um registro usa GTIN e outro código interno, converte ambos para
    // o código interno cadastrado antes de formar a chave.
    if (global.DTProdutos && typeof global.DTProdutos.buscarSync === 'function') {
      for (var i=0; i<ids.length; i++) {
        try {
          var achado = global.DTProdutos.buscarSync(ids[i]);
          if (achado && achado.encontrado) {
            return texto(achado.codigoInterno || achado.codigo_interno || achado.gtin || ids[i]);
          }
        } catch(e){ console.warn("[Erro tratado]", e); }
      }
    }
    return ids[0] || 'SEM_PRODUTO';
  }
  function chave(obj, inventarios){
    obj = obj || {};
    // Recalcula a chave a partir dos campos atuais. Registros antigos podem ter
    // chave_fluxo gravada apenas por inventario/endereco, o que mistura produtos
    // diferentes na mesma divergencia/recontagem.
    var inv = inventario(obj, inventarios);
    var end = endereco(obj.endereco);
    var prod = produto(obj);
    if (prod !== 'SEM_PRODUTO') return inv + '|' + end + '|' + prod;
    var gravada = texto(obj.chave_fluxo);
    if (gravada && gravada.split('|').length >= 3) return gravada;
    return inv + '|' + end + '|' + prod;
  }
  function mesmo(a,b,inventarios){
    if (!a || !b) return false;
    var aid=texto(a.divergencia_id), bid=texto(b.divergencia_id);
    if (aid && bid && aid === bid) return true;
    return chave(a,inventarios) === chave(b,inventarios);
  }
  global.InventoryFlowKey = { texto:texto, endereco:endereco, inventario:inventario, produto:produto, chave:chave, mesmo:mesmo };
})(window);
